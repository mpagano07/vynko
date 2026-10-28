'use client';

import type { GooglePickerResponse } from '@/types/google';

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const GOOGLE_APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;

export async function loadGooglePickerScript(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.gapi && window.google?.picker) return;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      if (window.gapi) {
        (window.gapi.load as (api: string, callback: () => void) => void)('picker', () => resolve());
      } else {
        reject(new Error('No se pudo cargar Google API'));
      }
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

export async function openDrivePicker(
  accessToken: string,
  onPick: (fileId: string, fileName: string) => void
): Promise<void> {
  await loadGooglePickerScript();

  if (!window.google?.picker || !GOOGLE_API_KEY) {
    throw new Error('Google Picker no está configurado');
  }

  const view = new window.google.picker.DocsView(
    window.google.picker.ViewId.DOCS
  )
    .setIncludeFolders(false)
    .setMimeTypes(
      'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'
    );

  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessToken)
    .setDeveloperKey(GOOGLE_API_KEY)
    .setTitle('Seleccionar archivo para importar')
    .setCallback((data: GooglePickerResponse) => {
      if (data.action === window.google?.picker?.Action.PICKED && data.docs?.[0]) {
        const doc = data.docs[0];
        onPick(doc.id, doc.name);
      }
    })
    .build();

  picker.setVisible(true);
}
