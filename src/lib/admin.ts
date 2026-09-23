export const ADMIN_EMAIL = 'matias.pagano07@gmail.com';

export function isAdminEmail(email?: string | null) {
  return email?.toLowerCase() === ADMIN_EMAIL;
}