const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('../middleware/passport');
const { prepare } = require('../database');
const { generateToken } = require('../middleware/auth');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validateCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0, rest;
  for (let i = 1; i <= 9; i++) sum += parseInt(cpf.substring(i - 1, i)) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(cpf.substring(9, 10))) return false;
  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(cpf.substring(i - 1, i)) * (12 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(cpf.substring(10, 11))) return false;
  return true;
}

router.get('/login', asyncHandler(async (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rytech3d_jwt_secret_key_2026_secure');
      return res.redirect('/checkout');
    } catch {}
  }
  res.render('login', { error: null, redirect: req.query.redirect || '/checkout' });
}));

router.get('/register', asyncHandler(async (req, res) => {
  res.render('register', { error: null, formData: {} });
}));

router.post('/register', asyncHandler(async (req, res) => {
  try {
    const { full_name, cpf, email, password, confirm_password, phone, street, number, complement, neighborhood, city, state, zip_code } = req.body;

    if (!full_name || !cpf || !email || !password || !confirm_password || !phone || !street || !number || !neighborhood || !city || !state || !zip_code) {
      return res.render('register', { error: 'Todos os campos obrigatórios devem ser preenchidos.', formData: req.body });
    }

    if (password.length < 6) {
      return res.render('register', { error: 'A senha deve ter no mínimo 6 caracteres.', formData: req.body });
    }

    if (password !== confirm_password) {
      return res.render('register', { error: 'As senhas não conferem.', formData: req.body });
    }

    const cpfClean = cpf.replace(/\D/g, '');
    if (!validateCPF(cpfClean)) {
      return res.render('register', { error: 'CPF inválido. Verifique o número informado.', formData: req.body });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.render('register', { error: 'Email inválido.', formData: req.body });
    }

    const existingUser = await prepare('SELECT id FROM users WHERE email = ? OR cpf = ?').get(email, cpfClean);
    if (existingUser) {
      return res.render('register', { error: 'Já existe um usuário com este email ou CPF.', formData: req.body });
    }

    const hash = bcrypt.hashSync(password, 10);

    await prepare(`INSERT INTO users (full_name, cpf, email, password, phone, street, number, complement, neighborhood, city, state, zip_code) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      full_name, cpfClean, email, hash, phone.replace(/\D/g, ''),
      street, number, complement || '', neighborhood, city, state, zip_code.replace(/\D/g, '')
    );

    const user = await prepare('SELECT * FROM users WHERE email = ?').get(email);
    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect('/checkout');
  } catch (err) {
    console.error('Erro no registro:', err);
    res.render('register', { error: 'Erro ao criar conta. Tente novamente.', formData: req.body });
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  try {
    const { email, password, redirect } = req.body;
    if (!email || !password) {
      return res.render('login', { error: 'Preencha email e senha.', redirect: redirect || '/checkout' });
    }

    const user = await prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { error: 'Email ou senha incorretos.', redirect: redirect || '/checkout' });
    }

    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect(redirect || '/checkout');
  } catch (err) {
    console.error('Erro no login:', err);
    res.render('login', { error: 'Erro ao fazer login. Tente novamente.', redirect: req.body.redirect || '/checkout' });
  }
}));

router.get('/logout', asyncHandler(async (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
}));

router.get('/profile', asyncHandler(async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.redirect('/login');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rytech3d_jwt_secret_key_2026_secure');
    const user = await prepare('SELECT id, full_name, cpf, email, phone, street, number, complement, neighborhood, city, state, zip_code FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.redirect('/login');
    res.render('profile', { user, error: null, success: null });
  } catch {
    res.clearCookie('token');
    res.redirect('/login');
  }
}));

router.post('/profile/update', asyncHandler(async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rytech3d_jwt_secret_key_2026_secure');
    const { full_name, phone, street, number, complement, neighborhood, city, state, zip_code } = req.body;

    await prepare(`UPDATE users SET full_name=?, phone=?, street=?, number=?, complement=?, neighborhood=?, city=?, state=?, zip_code=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(full_name || '', phone.replace(/\D/g, ''), street, number, complement || '', neighborhood, city, state, zip_code.replace(/\D/g, ''), decoded.id);

    const user = await prepare('SELECT id, full_name, cpf, email, phone, street, number, complement, neighborhood, city, state, zip_code FROM users WHERE id = ?').get(decoded.id);
    res.render('profile', { user, success: 'Dados atualizados com sucesso!', error: null });
  } catch (err) {
    console.error('Erro ao atualizar perfil:', err);
    res.status(500).json({ error: 'Erro ao atualizar dados.' });
  }
}));

router.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  (req, res) => {
    const token = generateToken(req.user);
    res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect('/checkout');
  }
);

module.exports = router;
