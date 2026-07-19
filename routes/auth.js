const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { db } = require('../config/firebase');
const { verifyToken, JWT_SECRET } = require('../middleware/auth');

// Seed a default admin if none exist
const seedDefaultAdmin = async () => {
  try {
    const adminsSnapshot = await db.collection('admins').limit(1).get();
    if (adminsSnapshot.empty) {
      console.log('No admin accounts found. Seeding default admin...');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await db.collection('admins').add({
        fullName: 'Default Super Admin',
        email: 'admin@allocleaning.com',
        passwordHash: hashedPassword,
        role: 'Super Admin',
        createdAt: new Date().toISOString()
      });
      console.log('Default admin seeded: admin@allocleaning.com / admin123');
    }
  } catch (error) {
    console.error('Error seeding default admin:', error);
  }
};

// Expose seeding function to be called from server.js
router.seedDefaultAdmin = seedDefaultAdmin;

// Route 1: Validate email & password, directly issue JWT on success
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const cleanEmail = email.toLowerCase().trim();
    // 1. Find admin by email
    const adminSnapshot = await db.collection('admins').where('email', '==', cleanEmail).get();
    
    if (adminSnapshot.empty) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    let adminDoc;
    let adminData;
    adminSnapshot.forEach(doc => {
      adminDoc = doc;
      adminData = doc.data();
    });

    // 2. Validate password
    const isMatch = await bcrypt.compare(password, adminData.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // 3. Create JWT
    const token = jwt.sign(
      { 
        id: adminDoc.id, 
        email: adminData.email, 
        fullName: adminData.fullName,
        role: adminData.role 
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    console.log(`🔐 ADMIN SIGNED IN DIRECTLY: ${cleanEmail}`);

    res.status(200).json({
      token,
      admin: {
        id: adminDoc.id,
        email: adminData.email,
        fullName: adminData.fullName,
        role: adminData.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error during login.' });
  }
});


// Route 3: Get details of current token holder
router.get('/me', verifyToken, async (req, res) => {
  try {
    const adminDoc = await db.collection('admins').doc(req.admin.id).get();
    if (!adminDoc.exists) {
      return res.status(404).json({ message: 'Admin profile not found.' });
    }
    
    const adminData = adminDoc.data();
    res.status(200).json({
      admin: {
        id: adminDoc.id,
        email: adminData.email,
        fullName: adminData.fullName,
        role: adminData.role
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;
