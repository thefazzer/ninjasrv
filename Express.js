const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const express = require('express');
const session = require('express-session');

const app = express();
const port = 3000;

app.use(session({ secret: 'secretKey', resave: false, saveUninitialized: false }));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: '740807273849-h1btj8ui5fkdvq14a9ulnl601ukbq6p0.apps.googleusercontent.com',
  clientSecret: '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',
  callbackURL: "http://www.example.com/auth/google/callback"
},
function(accessToken, refreshToken, profile, cb) {
  profile.isAdmin = true; // Add isAdmin flag to the profile
  return cb(null, profile);
}
));

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    req.session.isAdmin = req.user.isAdmin;
    res.redirect('/');
  });

function isAdmin(req, res, next) {
  if (req.session.isAdmin) {
    next();
  } else {
    res.status(403).send('You are not authorized to perform this action');
  }
}

let dummyServiceStatus = 'stopped';

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

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`)
});
