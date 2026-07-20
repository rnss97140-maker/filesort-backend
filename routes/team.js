'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../utils/db');
const { sendTeamInvite } = require('../utils/mailer');
const { authMiddleware, requirePro } = require('../middleware/auth');

const MAX_MEMBERS = 10;

router.post('/create', authMiddleware, requirePro, async (req, res) => {
  const user = req.user;
  if (user.team_id) return res.status(400).json({ error: 'You already have a team' });
  const teamId = 'team_' + Date.now();
  const name   = (req.body.teamName || `${user.name}'s Team`).trim();
  await db.transaction(async (c) => {
    await c.query('INSERT INTO teams (id,name,owner_id,owner_email) VALUES ($1,$2,$3,$4)', [teamId, name, user.id, user.email]);
    await c.query('INSERT INTO team_members (team_id,email,role) VALUES ($1,$2,$3)', [teamId, user.email, 'owner']);
    await c.query('UPDATE users SET team_id=$1, updated_at=NOW() WHERE id=$2', [teamId, user.id]);
  });
  const team = await db.get('SELECT * FROM teams WHERE id=$1', [teamId]);
  res.status(201).json({ message: 'Team created', team });
});

router.post('/invite', authMiddleware, requirePro, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  const owner = req.user;

  if (!owner.team_id) {
    const teamId = 'team_' + Date.now();
    const name   = `${owner.name}'s Team`;
    await db.transaction(async (c) => {
      await c.query('INSERT INTO teams (id,name,owner_id,owner_email) VALUES ($1,$2,$3,$4)', [teamId, name, owner.id, owner.email]);
      await c.query('INSERT INTO team_members (team_id,email,role) VALUES ($1,$2,$3)', [teamId, owner.email, 'owner']);
      await c.query('UPDATE users SET team_id=$1, updated_at=NOW() WHERE id=$2', [teamId, owner.id]);
    });
    owner.team_id = teamId;
  }

  const team    = await db.get('SELECT * FROM teams WHERE id=$1', [owner.team_id]);
  const members = await db.all('SELECT * FROM team_members WHERE team_id=$1', [owner.team_id]);
  if (members.length >= MAX_MEMBERS) return res.status(400).json({ error: `Team limit reached (${MAX_MEMBERS} members)` });
  if (members.find(m => m.email === email.toLowerCase())) return res.status(400).json({ error: 'Already a member' });

  const token = 'inv_' + crypto.randomBytes(32).toString('hex');
  const exp   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.run(
    'INSERT INTO invites (token,email,team_id,invited_by,inviter_name,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [token, email.toLowerCase(), owner.team_id, owner.email, owner.name, exp]
  );

  const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/accept-invite?token=${token}`;
  sendTeamInvite({ toEmail: email, inviterName: owner.name, teamName: team.name, inviteLink }).catch(e => console.warn(e.message));
  res.json({ message: `Invite sent to ${email}`, inviteLink, expiresAt: exp });
});

router.post('/accept/:token', authMiddleware, async (req, res) => {
  const invite = await db.get('SELECT * FROM invites WHERE token=$1', [req.params.token]);
  if (!invite)       return res.status(404).json({ error: 'Invite not found' });
  if (invite.used)   return res.status(400).json({ error: 'Invite already used' });
  if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'Invite expired' });
  if (invite.email !== req.user.email) return res.status(403).json({ error: 'Invite sent to different email' });
  const team = await db.get('SELECT * FROM teams WHERE id=$1', [invite.team_id]);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  await db.transaction(async (c) => {
    await c.query('INSERT INTO team_members (team_id,email,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [invite.team_id, req.user.email, 'editor']);
    await c.query('UPDATE users SET team_id=$1, updated_at=NOW() WHERE id=$2', [invite.team_id, req.user.id]);
    await c.query('UPDATE invites SET used=TRUE, accepted_at=NOW() WHERE token=$1', [invite.token]);
  });
  res.json({ message: `You've joined ${team.name}!`, team });
});

router.get('/members', authMiddleware, requirePro, async (req, res) => {
  if (!req.user.team_id) return res.json({ team: null, members: [] });
  const team    = await db.get('SELECT * FROM teams WHERE id=$1', [req.user.team_id]);
  const members = await db.all('SELECT tm.*, u.name, u.plan FROM team_members tm LEFT JOIN users u ON u.email=tm.email WHERE tm.team_id=$1', [req.user.team_id]);
  res.json({ team, members });
});

router.delete('/member/:email', authMiddleware, requirePro, async (req, res) => {
  const owner = req.user;
  if (!owner.team_id) return res.status(404).json({ error: 'No team found' });
  const team = await db.get('SELECT * FROM teams WHERE id=$1', [owner.team_id]);
  if (team.owner_email !== owner.email) return res.status(403).json({ error: 'Only owner can remove members' });
  const target = req.params.email;
  if (target === owner.email) return res.status(400).json({ error: 'Cannot remove yourself' });
  await db.transaction(async (c) => {
    await c.query('DELETE FROM team_members WHERE team_id=$1 AND email=$2', [owner.team_id, target]);
    await c.query('UPDATE users SET team_id=NULL, updated_at=NOW() WHERE email=$1', [target]);
  });
  const members = await db.all('SELECT * FROM team_members WHERE team_id=$1', [owner.team_id]);
  res.json({ message: `${target} removed`, members });
});

module.exports = router;
