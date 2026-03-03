'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// In-memory fallback if no DB
let memContacts = [];

router.get('/', async (req, res) => {
  if (db.isAvailable()) {
    return res.json(await db.getContacts(req.query.q || ''));
  }
  const q = (req.query.q || '').toLowerCase();
  res.json(q ? memContacts.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q)) : memContacts);
});

router.post('/', async (req, res) => {
  const { name, phone, notes } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const id = uuidv4();
  if (db.isAvailable()) {
    await db.saveContact(id, name, phone.trim(), notes || '');
    return res.status(201).json({ id, name, phone: phone.trim(), notes: notes || '' });
  }
  const contact = { id, name, phone: phone.trim(), notes: notes || '', created_at: new Date().toISOString() };
  memContacts.push(contact);
  res.status(201).json(contact);
});

router.put('/:id', async (req, res) => {
  const { name, phone, notes } = req.body;
  if (db.isAvailable()) {
    await db.saveContact(req.params.id, name, phone, notes);
    return res.json({ id: req.params.id, name, phone, notes });
  }
  const idx = memContacts.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  memContacts[idx] = { ...memContacts[idx], ...req.body };
  res.json(memContacts[idx]);
});

router.delete('/:id', async (req, res) => {
  if (db.isAvailable()) {
    await db.deleteContact(req.params.id);
    return res.sendStatus(204);
  }
  memContacts = memContacts.filter(c => c.id !== req.params.id);
  res.sendStatus(204);
});

module.exports = router;
