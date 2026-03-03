'use strict';
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

/**
 * In-memory contacts store.
 * PRODUCTION NOTE: Replace with a real database (Postgres, MongoDB, SQLite etc.)
 * Each contact: { id, name, phone, notes, createdAt }
 */
let contacts = [];

router.get('/', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (q) {
    return res.json(contacts.filter(c =>
      c.name.toLowerCase().includes(q) || c.phone.includes(q)
    ));
  }
  res.json(contacts);
});

router.post('/', (req, res) => {
  const { name, phone, notes } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const contact = { id: uuidv4(), name, phone: phone.trim(), notes: notes || '', createdAt: new Date().toISOString() };
  contacts.push(contact);
  res.status(201).json(contact);
});

router.put('/:id', (req, res) => {
  const idx = contacts.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  contacts[idx] = { ...contacts[idx], ...req.body, id: contacts[idx].id };
  res.json(contacts[idx]);
});

router.delete('/:id', (req, res) => {
  contacts = contacts.filter(c => c.id !== req.params.id);
  res.sendStatus(204);
});

module.exports = router;
