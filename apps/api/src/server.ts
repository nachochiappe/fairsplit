import { createApp } from './app';

const app = createApp();
const port = Number(process.env.API_PORT ?? 4000);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
