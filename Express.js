const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');

const app = express();
const port = 3000;
const YOUR_FOLDER_ID = `1VgStbKc5zL0DFJ7BRZYGf7nlu7-OOThM`
app.use(session({ secret: 'your-secret', resave: false, saveUninitialized: true }));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

passport.use(new GoogleStrategy({
  clientID: '740807273849-h1btj8ui5fkdvq14a9ulnl601ukbq6p0.apps.googleusercontent.com',
  clientSecret: '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',
  callbackURL: `http://localhost:${port}/auth/google/callback`
},
function(accessToken, refreshToken, profile, cb) {
  profile.accessToken = accessToken;
  return cb(null, profile);
}));

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'https://www.googleapis.com/auth/drive.readonly'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    res.redirect('/');
  });

let dummyServiceStatus = 'stopped';

function isAdmin(req, res, next) {
  if (req.user) {
    next();
  } else {
    res.status(403).send('You are not authorized to perform this action');
  }
}

app.get('/status', isAdmin, (req, res) => {
  res.send(`Dummy service is currently: ${dummyServiceStatus}`);
});

app.post('/start', isAdmin, (req, res) => {
  dummyServiceStatus = 'running';
  res.send('Dummy service started');
});

app.post('/stop', isAdmin, (req, res) => {
  dummyServiceStatus = 'stopped';
  res.send('Dummy service stopped');
});

app.get('/list-files', isAdmin, (req, res) => {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: req.user.accessToken
  });

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  drive.files.list({
    q: "'" + YOUR_FOLDER_ID + "' in parents", // Replace YOUR_FOLDER_ID with your actual folder ID
    fields: 'files(id, name)',
    spaces: 'drive'
  }, (err, result) => {
    if (err) {
      res.status(500).send(err);
    } else {
      res.send(result.data.files);
    }
  });
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
});
