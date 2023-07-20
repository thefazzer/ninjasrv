require('dotenv').config();
const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { OAuth2Client } = require('googleapis').Auth;

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');

const app = express();
const port = 3000;

const cutoffDate = new Date('2023-06-14');

const GOOGLE_DRIVE_FOLDER_ID = '18DAq4TnVPNDKgl7a_rLN-XQfaEKrbwXJ';
const TRANSCRIPT_FOLDER_NAME = 'transcript5'
const TMP_FOLDER_NAME = path.join(os.tmpdir(), 'ninja')
let transcriptsFolderId;

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

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID, 
    process.env.GOOGLE_CLIENT_SECRET, 
    'http://localhost:3000/callback'
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const userinfoResponse = await oauth2Client.request({
      url: 'https://www.googleapis.com/oauth2/v1/userinfo'
    });

    const user = {
      id: userinfoResponse.data.id,
      email: userinfoResponse.data.email,
      name: userinfoResponse.data.name,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };

    req.login(user, (err) => {
      if (err) {
        console.error('Error logging in', err);
        res.status(500).send('Error logging in');
        return;
      }

      res.redirect('/');
    });
  
  } catch (err) {
    console.error('Error retrieving access token', err);
    res.status(500).send('Error retrieving access token');
  }
});

async function createGoogleDriveDirectory(drive, parentFolderId, folderName) {
  // check if folder exists
  let response = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and name='${folderName}' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive'
  });
  
  // if not exists, create one
  if (response.data.files.length == 0) {
    var fileMetadata = {
      'name': folderName,
      'mimeType': 'application/vnd.google-apps.folder',
      'parents': [parentFolderId]
    };
    response = await drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    });
    console.log('Folder ID: ', response.data.id);
    return response.data.id;
  } else {
    console.log('Folder already exists');
    return response.data.files[0].id;
  }
}

app.get('/list-files', ensureAuthenticated, async (req, res, next) => {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({access_token: req.user.accessToken});

    const drive = google.drive({
      version: 'v3',
      auth: oauth2Client
    });
    
    const response = await drive.files.list({
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    transcriptsFolderId = await createGoogleDriveDirectory(drive, GOOGLE_DRIVE_FOLDER_ID, TRANSCRIPT_FOLDER_NAME); // Call the function here

    res.send(JSON.stringify(response.data.files, null, 2)); // Pretty print

  } catch (err) {
    res.status(500).send(err);
  }
});

// Download file from Google Drive, process and upload it back
async function processAudioFiles(drive) {
  try {
    // Create the transcripts directory if it doesn't exist
    if (!fs.existsSync(path.join(TMP_FOLDER_NAME, 'transcripts'))) {
      fs.mkdirSync(path.join(TMP_FOLDER_NAME, 'transcripts'), { recursive: true });
    };

    const audioFiles = await drive.files.list({
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    for (const file of audioFiles.data.files) {
      const filename = file.name;

      // Split the filename to get the date string
      const dateStr = filename.split('_')[1];

      // Parse the date from the filename
      const fileDateParts = dateStr.split('-');
      const fileDate = new Date(fileDateParts[2], fileDateParts[1] - 1, fileDateParts[0]);

      // Compare the file date to the cutoff date
      if (fileDate <= cutoffDate) {
        continue;
      }
  
      const base_filename = path.basename(filename, '.wav');
      const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });
      const dest = fs.createWriteStream(path.join(TMP_FOLDER_NAME, filename));

      if (!fs.existsSync(path.join(TMP_FOLDER_NAME, filename))) {
        // File doesn't exist in /tmp directory, so download it
        
        await new Promise((resolve, reject) => {
          res.data
            .on('end', () => {
              console.log(`Downloaded ${filename}`);
              resolve();
            })
            .on('error', err => reject(err))
            .pipe(dest);
        });
      } else {
        console.log(`File ${filename} already exists in ${TMP_FOLDER_NAME}} directory. Skipping download.`);
      }

      await new Promise((resolve, reject) => {
        res.data
          .on('end', async () => {
            console.log(`Processing ${filename}`);

            // Checking if file has been processed
            if (fs.existsSync(path.join(TMP_FOLDER_NAME, 'transcripts', `${base_filename}.txt`)) || fs.existsSync(path.join(TMP_FOLDER_NAME, 'transcripts', `${base_filename}_16khz.txt`))) {
              console.log(`File ${filename} has been processed before.`);
              return;
            }

            // Check the sample rate
            const { stdout, stderr } = await exec(`file ${path.join(TMP_FOLDER_NAME, filename)}`);

            // Create a separate variable for the converted filename
            let processedFilename = filename;

            // Convert to 16kHz if necessary
            if (!stdout.includes("16000 Hz")) {
              await exec(`ffmpeg -i ${path.join(TMP_FOLDER_NAME, filename)} -af "silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-90dB" -ar 16000 ${path.join(TMP_FOLDER_NAME, `${base_filename}_16khz.wav`)}`);
              processedFilename = `${base_filename}_16khz.wav`;
            }
            
            // Run the C++ main program and output to transcripts directory
            await exec(`../whisper.cpp/main -m ../whisper.cpp/models/ggml-base.en.bin -f ${path.join(TMP_FOLDER_NAME, processedFilename)} -tdrz -otxt -of ${path.join(TMP_FOLDER_NAME, 'transcripts', `${base_filename}`)}`);
          })
          .on('error', err => {
            console.error(`Error downloading file ${filename}: ${err}`);
            reject(err);
          })
          .pipe(dest)
          .on('finish', resolve)
          .on('error', reject);
      });

      // Upload the transcript file to Google Drive
      const fileMetadata = {
        'name': `${base_filename}.txt`,
        'parents': [TRANSCRIPT_FOLDER_ID]  // Replace this with your transcript folder's ID
      };
      const media = {
        mimeType: 'text/plain',
        body: fs.createReadStream(path.join(TMP_FOLDER_NAME, 'transcripts', `${base_filename}.txt`))
      };
      await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id'
      });
      console.log(`Uploaded ${base_filename}.txt to Google Drive in folder ${TRANSCRIPT_FOLDER_NAME}.`);
    }
  } catch (err) {
      console.log('The API returned an error: ' + err);
  }
}
app.get('/process-files', ensureAuthenticated, async (req, res, next) => {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({access_token: req.user.accessToken});

    const drive = google.drive({
      version: 'v3',
      auth: oauth2Client
    });

    await processAudioFiles(drive);

    res.send('Files processed');

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
