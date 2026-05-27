const passport = require('passport');
const { prepare } = require('../database');
const { generateToken } = require('./auth');

if (process.env.GOOGLE_CLIENT_ID) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('Email do Google não disponível'));

      let user = await prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
      if (user) return done(null, user);

      user = await prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (user) {
        await prepare('UPDATE users SET google_id = ? WHERE id = ?').run(profile.id, user.id);
        return done(null, user);
      }

      const name = profile.displayName || email.split('@')[0];
      await prepare(`INSERT INTO users (full_name, cpf, email, password, phone, street, number, neighborhood, city, state, zip_code, google_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(name, '', email, '', '', '', '', '', '', '', '', profile.id);

      user = await prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  }));
}

module.exports = passport;
