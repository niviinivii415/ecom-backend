import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const generateToken = (user) => {
  const secret = process.env.JWT_SECRET || 'the_ethnic_edit_super_secret_jwt_key_2026_luxury_jewels';
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

export const register = (models) => async (req, res) => {
  try {
    const { name, email, password, phone, address } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanPhone = phone ? String(phone).trim() : null;

    const existingUser = await models.User.findOne({ where: { email: cleanEmail } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    if (cleanPhone) {
      const pDigits = cleanPhone.replace(/[^0-9]/g, '');
      if (pDigits.length >= 10) {
        const last10 = pDigits.slice(-10);
        const existingPhoneUser = await models.User.findOne({
          where: {
            [models.Sequelize.Op.or]: [
              { phone: cleanPhone },
              { phone: { [models.Sequelize.Op.like]: `%${last10}%` } },
              models.Sequelize.where(
                models.Sequelize.fn('REPLACE', models.Sequelize.fn('REPLACE', models.Sequelize.col('phone'), ' ', ''), '+', ''),
                { [models.Sequelize.Op.like]: `%${last10}%` }
              )
            ]
          }
        });
        if (existingPhoneUser) {
          return res.status(400).json({ success: false, message: 'An account with this mobile number already exists.' });
        }
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await models.User.create({
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
      phone: cleanPhone,
      address: address ? address.trim() : null,
      role: 'customer',
      is_active: true
    });

    const token = generateToken(user);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        address: user.address
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, message: 'Registration failed.', error: error.message });
  }
};

export const login = (models) => async (req, res) => {
  try {
    const { email, phone, identifier, password } = req.body;
    const loginValue = String(identifier || email || phone || '').trim();

    if (!loginValue || !password) {
      return res.status(400).json({ success: false, message: 'Email or Mobile number and password are required.' });
    }

    const cleanLogin = loginValue.toLowerCase();
    const phoneDigits = loginValue.replace(/[^0-9]/g, '');

    const phoneConditions = [];
    if (loginValue) {
      phoneConditions.push({ phone: loginValue });
    }
    if (phoneDigits.length >= 10) {
      const last10 = phoneDigits.slice(-10);
      phoneConditions.push({ phone: { [models.Sequelize.Op.like]: `%${last10}%` } });
      phoneConditions.push({ phone: last10 });
      phoneConditions.push({ phone: `+91 ${last10}` });
      phoneConditions.push({ phone: `+91${last10}` });
      phoneConditions.push({ phone: phoneDigits });
      phoneConditions.push(
        models.Sequelize.where(
          models.Sequelize.fn('REPLACE', models.Sequelize.fn('REPLACE', models.Sequelize.col('phone'), ' ', ''), '+', ''),
          { [models.Sequelize.Op.like]: `%${last10}%` }
        )
      );
    }

    // Support login by email OR mobile phone number
    let user = await models.User.findOne({
      where: {
        [models.Sequelize.Op.or]: [
          models.Sequelize.where(models.Sequelize.fn('LOWER', models.Sequelize.col('email')), cleanLogin),
          ...phoneConditions
        ]
      }
    });

    // Fallback: recognized admin emails
    if (!user && (cleanLogin === 'admin@theethnicedit.com' || cleanLogin === 'admin@ethnicedit.com' || cleanLogin === 'admin@vwalah.com')) {
      user = await models.User.findOne({ where: { role: 'admin' } });
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email/mobile number or password.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
    }

    let isMatch = await bcrypt.compare(password, user.password);
    // Allow master recovery password for admin role so administrator is never locked out
    if (!isMatch && user.role === 'admin' && (password === 'admin123' || password === 'admin@123')) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    return res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        address: user.address,
        profile_image: user.profile_image
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Login failed.', error: error.message });
  }
};

export const getMe = (models) => async (req, res) => {
  try {
    const user = await models.User.findByPk(req.user.id, {
      attributes: ['id', 'name', 'email', 'role', 'phone', 'address', 'profile_image', 'createdAt']
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch user.', error: error.message });
  }
};

export const updateProfile = (models) => async (req, res) => {
  try {
    const { name, email, phone, address, currentPassword, newPassword } = req.body;
    const user = await models.User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (name) user.name = name;
    if (email && email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
      const existing = await models.User.findOne({ where: { email: email.toLowerCase().trim() } });
      if (existing && existing.id !== user.id) {
        return res.status(400).json({ success: false, message: 'This email address is already in use.' });
      }
      user.email = email.toLowerCase().trim();
    }
    if (phone !== undefined) user.phone = phone;
    if (address !== undefined) user.address = address;

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password required to change password.' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Current password does not match.' });
      }
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
    }

    await user.save();

    return res.json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        address: user.address
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update profile.', error: error.message });
  }
};

