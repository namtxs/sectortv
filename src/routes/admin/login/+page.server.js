import { fail, redirect } from '@sveltejs/kit';
import { checkPassword, login, isAuthed } from '$lib/server/auth.js';

export function load({ cookies }) {
  if (isAuthed(cookies)) throw redirect(303, '/admin');
  return {};
}

export const actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const password = (data.get('password') || '').toString();
    if (!checkPassword(password)) {
      return fail(401, { error: 'Password salah.' });
    }
    login(cookies);
    throw redirect(303, '/admin');
  }
};
