import { json } from '../../_lib/http.js';

export function onRequestGet({ env }) {
  return json({
    configurado: Boolean(env.APPS_SCRIPT_URL && env.SHEETS_TOKEN),
    link: `https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/edit`,
  });
}
