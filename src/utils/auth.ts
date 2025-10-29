import path from "node:path";
import { google, oauth2_v2 } from "googleapis";
import { fileURLToPath } from "node:url";
import { readJSONSync, writeJSONSync } from "./helpers.js";

// ---- Auth (ESM) -------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_PATH = path.join(__dirname, "../../token.json");
const CREDENTIALS_PATH = path.join(__dirname, "../../credentials.json");
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export const authorize = async (): Promise<any> => {
  const credentials = readJSONSync(CREDENTIALS_PATH);
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  try {
    const token = readJSONSync(TOKEN_PATH);
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } catch {
    return getNewToken(oAuth2Client);
  }
};

export const getNewToken = (oAuth2Client: any) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("\nAuthorize this app by visiting this URL:\n", authUrl, "\n");
  process.stdout.write("Paste the code here and press Enter: ");

  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", async (code: string) => {
      try {
        const { tokens } = await oAuth2Client.getToken(code.trim());
        oAuth2Client.setCredentials(tokens);
        writeJSONSync(TOKEN_PATH, tokens);
        console.log("Token saved to", TOKEN_PATH);
        resolve(oAuth2Client);
      } catch (err) {
        console.error("Error retrieving access token", err);
        process.exit(1);
      }
    });
  });
};
