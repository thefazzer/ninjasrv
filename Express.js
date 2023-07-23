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

const cron = require('node-cron');
const cliProgress = require('cli-progress');

let bar; // initialize a variable for cli-progress

const FIVE_MINUTES_IN_MS = 300000;

const app = express();
const port = 3000;

const cutoffDate = new Date(process.env.CUTOFF);

let GOOGLE_DRIVE_USERFOLDER_ID;
const TRANSCRIPT_FOLDER_NAME = 'transcripts'
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

async function getFolderIdByPath(drive, path) {
  const folderNames = path.split('/');

  let currentParentId = 'root'; // Start with the root

  for (let folderName of folderNames) {
      currentParentId = await getFolderIdByName(drive, folderName, currentParentId);
      if (!currentParentId) {
          throw new Error(`Folder ${folderName} not found.`);
      }
  }

  return currentParentId; // This will be the ID of the last folder in the path
}

async function getFolderIdByName(drive, folderName, parentFolderId) {
  try {
    const response = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${parentFolderId}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (response.data.files.length > 0) {
      return response.data.files[0].id;
    } else {
      throw new Error(`Folder ${folderName} not found`);
    }
  } catch (err) {
    console.error(err);
  }
}

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
    
    // Retrieve the Google Drive Folder ID by user's name
    let UserFiledId = await getFolderIdByPath(drive, process.env.ROOT_REMOTE);
    console.log(UserFiledId);

    const response = await drive.files.list({
      q: `'${UserFiledId}' in parents`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    res.send(JSON.stringify(response.data.files, null, 2)); // Pretty print
  } catch (err) {
    console.error(err);
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

    // Retrieve the Google Drive Folder ID by user's name
    GOOGLE_DRIVE_USERFOLDER_ID = await getFolderIdByPath(drive, process.env.ROOT_REMOTE);
    console.log(GOOGLE_DRIVE_USERFOLDER_ID);
  
    const audioFiles = await drive.files.list({
      q: `'${GOOGLE_DRIVE_USERFOLDER_ID}' in parents and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });
    
    // Create a new progress bar instance and use shades_classic theme
    bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  
    // Start the progress bar with a total value of audioFiles.length and set the current value to 0
    bar.start(audioFiles.data.files.length, 0);
  
    let filesProcessed = 0; // initialize a variable to track files processed
    let startProcessingTime = Date.now(); // note the start time
  

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
            
            GOOGLE_DRIVE_USERFOLDER_ID = await getFolderIdByPath(drive, process.env.ROOT_REMOTE);
            console.log(GOOGLE_DRIVE_USERFOLDER_ID);
  
            transcriptsFolderId = await createGoogleDriveDirectory(drive, GOOGLE_DRIVE_USERFOLDER_ID, TRANSCRIPT_FOLDER_NAME); // Call the function here
      
            if (fs.existsSync(path.join(TMP_FOLDER_NAME, 'transcripts', `${base_filename}.txt`))) {
              // Upload the transcript file to Google Drive
              const fileMetadata = {
                'name': `${base_filename}.txt`,
                'parents': [transcriptsFolderId]  // Replace this with your transcript folder's ID
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
          })
          .on('error', err => {
            console.error(`Error downloading file ${filename}: ${err}`);
            reject(err);
          })
          .pipe(dest)
          .on('finish', resolve)
          .on('error', reject);
      });

      bar.update(filesProcessed++); // update the progress bar

    // After processing each file, calculate and log the estimated time remaining
    let elapsedMillis = Date.now() - startProcessingTime;
    let avgMillisPerFile = elapsedMillis / filesProcessed;
    let remainingMillis = avgMillisPerFile * (audioFiles.data.files.length - filesProcessed);
    let remainingSecs = Math.round(remainingMillis / 1000);
    let remainingMins = Math.floor(remainingSecs / 60);
    remainingSecs = remainingSecs % 60;
    console.log(`Estimated time remaining: ${remainingMins} minutes, ${remainingSecs} seconds.`);

    }
    // After processing all files, stop the progress bar
    bar.stop();
  } catch (err) {
    console.log('The API returned an error: ' + err);
    if (bar) bar.stop(); // Ensure the bar stops even if there's an error
  }
}

    
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { 
    return next(); 
  }
  res.redirect('/auth/google');
}

app.listen(port, () => {
  console.log(`App listening on port ${port}`); 
});

app.get('/start', ensureAuthenticated, async (req, res) => {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: req.user.accessToken });

  const drive = google.drive({
    version: 'v3',
    auth: oauth2Client
  });

  try {
    cron.schedule('*/2 * * * *', async () => { // runs every 2 minutes
      let startProcessingTime = Date.now(); // note the start time
      console.log("Checking for new files...");
      await processAudioFiles(drive);
      let endProcessingTime = Date.now(); // note the end time
      console.log("Finished processing files, next check in 5 minutes...");
      console.log("Time elapsed: " + ((endProcessingTime - startProcessingTime) / 1000) + " seconds"); // print elapsed time in seconds
    });

    res.send("Started file processing task.");
  } catch (err) {
    res.status(500).send(err);
  }
});


app.get('/stop', (req, res) => {
  if (task) {
    task.destroy();
    task = null;
    res.send("Task stopped");
  } else {
    res.send("No task to stop");
  }
});

