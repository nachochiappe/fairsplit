export async function GET() {
  return new Response(null, {
    status: 204,
    headers: {
      'content-type': 'image/x-icon',
      'cache-control': 'public, max-age=86400',
    },
  });
}
