require('dotenv').config();
const fs = require('fs');
const path = require('path');
const exec = require('child_process').exec;
const { OAuth2Client } = require('googleapis').auth;

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');

const app = express();
const port = 3000;

const GOOGLE_DRIVE_FOLDER_ID = '1VgStbKc5zL0DFJ7BRZYGf7nlu7-OOThM';

app.use(session({ 
  secret: process.env.SESSION_SECRET,
  resave: false, 
  saveUninitialized: true 
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

const passportConfig = {
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://localhost:3000/callback'
};

passport.use(new GoogleStrategy(passportConfig,
  (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken;
    done(null, profile);
  })
);

app.get('/auth/google', 
  passport.authenticate('google', {
    scope: ['profile', 'https://www.googleapis.com/auth/drive']
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google'),
  (req, res) => {
    res.redirect('/');
  }
);

app.get('/list-files', ensureAuthenticated, async (req, res, next) => {
  try {
    const accessToken = req.user.accessToken;

    const drive = google.drive({
      version: 'v3',
      auth: accessToken
    });
    
    const response = await drive.files.list({
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    res.send(response.data.files);

  } catch (err) {
    res.status(500).send(err);
  }
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { 
    return next(); 
  }
  res.redirect('/auth/google');
}

app.listen(port, () => {
  console.log(`App listening on port ${port}`); 
});
