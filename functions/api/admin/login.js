import { json, exigirAdmin } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  return (await exigirAdmin(request, env)) ?? json({ ok: true });
}
