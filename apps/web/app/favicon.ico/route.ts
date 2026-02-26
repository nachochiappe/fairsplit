import { readFile } from 'node:fs/promises';
import path from 'node:path';

const faviconPath = path.join(process.cwd(), 'public', 'branding', 'favicon.ico');

export async function GET() {
  try {
    const icon = await readFile(faviconPath);
    return new Response(icon, {
      status: 200,
      headers: {
        'content-type': 'image/x-icon',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response(null, {
      status: 204,
      headers: {
        'content-type': 'image/x-icon',
        'cache-control': 'public, max-age=86400',
      },
    });
  }
}
