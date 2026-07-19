const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { db } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');


// Protect all admin management routes
router.use(verifyToken);

// Route 1: View all admin accounts
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('admins').get();
    const admins = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      admins.push({
        id: doc.id,
        fullName: data.fullName,
        email: data.email,
        role: data.role,
        createdAt: data.createdAt
      });
    });
    res.status(200).json(admins);
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ message: 'Failed to fetch admin accounts.' });
  }
});

// Route 2: Create a new admin account directly
router.post('/', async (req, res) => {
  const { fullName, email, password, role } = req.body;

  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  if (password.trim().length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
  }

  try {
    const cleanEmail = email.toLowerCase().trim();

    // Fetch caller actual role from DB
    const callerDoc = await db.collection('admins').doc(req.admin.id).get();
    if (!callerDoc.exists) {
      return res.status(404).json({ message: 'Caller profile not found.' });
    }
    const callerData = callerDoc.data();
    const callerRole = callerData.role;

    // Only a Super Admin can create admin accounts
    if (callerRole !== 'Super Admin') {
      return res.status(403).json({ message: 'Permission denied. Only the Super Admin can create admin accounts.' });
    }

    // 1. Check if email already exists
    const duplicateSnapshot = await db.collection('admins').where('email', '==', cleanEmail).get();
    if (!duplicateSnapshot.empty) {
      return res.status(400).json({ message: 'An admin account with this email already exists.' });
    }

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Save permanently
    const finalAdminData = {
      fullName: fullName.trim(),
      email: cleanEmail,
      passwordHash: hashedPassword,
      role: role.trim(),
      createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('admins').add(finalAdminData);

    let callerDemoted = false;
    // If a new Super Admin was created by the current Super Admin, demote the current Super Admin to Admin
    if (finalAdminData.role === 'Super Admin') {
      await db.collection('admins').doc(req.admin.id).update({
        role: 'Admin'
      });
      callerDemoted = true;
      console.log(`🔄 SUPER ADMIN ROLE TRANSFERRED: Current admin (${req.admin.email}) demoted to Admin. New admin (${cleanEmail}) is now the Super Admin.`);
    }

    res.status(201).json({
      message: 'Admin account created successfully.',
      admin: {
        id: docRef.id,
        fullName: finalAdminData.fullName,
        email: finalAdminData.email,
        role: finalAdminData.role,
        createdAt: finalAdminData.createdAt
      },
      callerDemoted
    });

  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ message: 'Failed to create admin account.' });
  }
});
// Route 3: Update password of an admin
router.put('/:id/password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const adminId = req.params.id;

  // Enforce password changes only to own account
  if (req.admin.id !== adminId) {
    return res.status(403).json({ message: 'Permission denied. You can only change your own password.' });
  }

  if (!oldPassword) {
    return res.status(400).json({ message: 'Old password is required.' });
  }

  if (!newPassword || newPassword.trim().length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
  }

  try {
    const adminDocRef = db.collection('admins').doc(adminId);
    const adminDoc = await adminDocRef.get();

    if (!adminDoc.exists) {
      return res.status(404).json({ message: 'Admin account not found.' });
    }

    const adminData = adminDoc.data();

    // Verify old password
    const isMatch = await bcrypt.compare(oldPassword, adminData.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect old password.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    await adminDocRef.update({
      passwordHash: hashedPassword
    });

    res.status(200).json({ message: 'Password updated successfully.' });

  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ message: 'Failed to update password.' });
  }
});
// Route 4: Delete an admin account
router.delete('/:id', async (req, res) => {
  const adminId = req.params.id;

  try {
    // 1. Fetch caller actual details from DB
    const callerDoc = await db.collection('admins').doc(req.admin.id).get();
    if (!callerDoc.exists) {
      return res.status(404).json({ message: 'Caller profile not found.' });
    }
    const callerData = callerDoc.data();
    const callerRole = callerData.role;

    const isSelfDeletion = req.admin.id === adminId;

    // Enforce deletion permissions:
    // - Every user can delete their own account.
    // - Only the Super Admin can delete other admin accounts.
    if (!isSelfDeletion && callerRole !== 'Super Admin') {
      return res.status(403).json({ message: 'Permission denied. Only the Super Admin can delete other admin accounts.' });
    }

    const adminDocRef = db.collection('admins').doc(adminId);
    const adminDoc = await adminDocRef.get();

    if (!adminDoc.exists) {
      return res.status(404).json({ message: 'Admin account not found.' });
    }

    // 2. Count total admins in database
    const countRes = await db.collection('admins').count().get();
    if (countRes.data().count <= 1) {
      return res.status(400).json({ message: 'Cannot delete admin. At least one admin account must remain.' });
    }

    // 3. Delete admin
    await adminDocRef.delete();
    res.status(200).json({ message: 'Admin account deleted successfully.' });

  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ message: 'Failed to delete admin account.' });
  }
});
// Route 5: Update admin profile details (like fullName or role)
router.put('/:id', async (req, res) => {
  const { fullName, role, transferOption, transferEmail, transferNewAdmin } = req.body;
  const adminId = req.params.id;

  if (req.admin.id !== adminId) {
    return res.status(403).json({ message: 'Permission denied. You can only update your own profile.' });
  }

  try {
    const adminDocRef = db.collection('admins').doc(adminId);
    const adminDoc = await adminDocRef.get();

    if (!adminDoc.exists) {
      return res.status(404).json({ message: 'Admin account not found.' });
    }

    const adminData = adminDoc.data();
    const updates = {};

    if (fullName) {
      updates.fullName = fullName.trim();
    }

    let roleTransferred = false;

    // Check if the current Super Admin is demoting themselves to Admin
    if (role && role === 'Admin' && adminData.role === 'Super Admin') {
      // They must transfer the Super Admin role to someone else
      if (transferOption === 'existing') {
        const cleanTransferEmail = transferEmail.toLowerCase().trim();
        const targetAdminSnapshot = await db.collection('admins').where('email', '==', cleanTransferEmail).get();
        
        if (targetAdminSnapshot.empty) {
          return res.status(400).json({ message: 'The specified transfer account does not exist.' });
        }

        let targetDocId;
        targetAdminSnapshot.forEach(doc => {
          targetDocId = doc.id;
        });

        // Promote the target admin
        await db.collection('admins').doc(targetDocId).update({
          role: 'Super Admin'
        });

        // Demote the current admin
        updates.role = 'Admin';
        roleTransferred = true;

      } else if (transferOption === 'new') {
        const { fullName: newName, email: newEmail, password: newPassword } = transferNewAdmin || {};
        
        if (!newName || !newEmail || !newPassword) {
          return res.status(400).json({ message: 'All fields for the new Super Admin account are required.' });
        }

        if (newPassword.trim().length < 6) {
          return res.status(400).json({ message: 'New Super Admin password must be at least 6 characters long.' });
        }

        const cleanNewEmail = newEmail.toLowerCase().trim();
        const duplicateSnapshot = await db.collection('admins').where('email', '==', cleanNewEmail).get();
        
        if (!duplicateSnapshot.empty) {
          return res.status(400).json({ message: 'An admin account with this email already exists.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Add the new Super Admin account
        await db.collection('admins').add({
          fullName: newName.trim(),
          email: cleanNewEmail,
          passwordHash: hashedPassword,
          role: 'Super Admin',
          createdAt: new Date().toISOString()
        });

        // Demote the current admin
        updates.role = 'Admin';
        roleTransferred = true;
      } else {
        return res.status(400).json({ message: 'You must specify how to transfer the Super Admin role.' });
      }
    }

    await adminDocRef.update(updates);

    res.status(200).json({
      message: 'Profile updated successfully.',
      fullName: updates.fullName || adminData.fullName,
      role: updates.role || adminData.role,
      roleTransferred
    });

  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({ message: 'Failed to update profile.' });
  }
});

module.exports = router;
