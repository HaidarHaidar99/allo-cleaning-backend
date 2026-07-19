const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');

// Route 1: Submit contact form (Public)
router.post('/', async (req, res) => {
  const { fullName, email, phoneNumber, message } = req.body;

  if (!fullName || !email || !phoneNumber || !message) {
    return res.status(400).json({ message: 'All form fields are required.' });
  }

  try {
    const formData = {
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      phoneNumber: phoneNumber.trim(),
      message: message.trim(),
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('forms').add(formData);

    res.status(201).json({
      message: 'Your message has been submitted successfully!',
      form: { id: docRef.id, ...formData }
    });
  } catch (error) {
    console.error('Error saving contact form:', error);
    res.status(500).json({ message: 'Failed to submit contact form. Please try again.' });
  }
});

// Route 2: Get all contact messages (Admin only)
router.get('/', verifyToken, async (req, res) => {
  try {
    let query = db.collection('forms').orderBy('createdAt', 'desc');
    
    const limitVal = parseInt(req.query.limit, 10);
    if (!isNaN(limitVal) && limitVal > 0) {
      query = query.limit(limitVal);
    }
    
    const snapshot = await query.get();
    const forms = [];
    snapshot.forEach(doc => {
      forms.push({ id: doc.id, ...doc.data() });
    });
    
    res.status(200).json(forms);
  } catch (error) {
    console.error('Error fetching contact forms:', error);
    res.status(500).json({ message: 'Failed to fetch contact forms.' });
  }
});

// Route 3: Get single contact message (Admin only)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const doc = await db.collection('forms').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Form submission not found.' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('Error fetching form details:', error);
    res.status(500).json({ message: 'Failed to fetch form details.' });
  }
});

// Route 4: Delete contact message (Admin only)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const docRef = db.collection('forms').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: 'Form submission not found.' });
    }

    await docRef.delete();
    res.status(200).json({ message: 'Form submission deleted successfully.' });
  } catch (error) {
    console.error('Error deleting form:', error);
    res.status(500).json({ message: 'Failed to delete form submission.' });
  }
});

module.exports = router;
