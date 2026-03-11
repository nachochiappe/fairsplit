import 'server-only';
import { createLogger } from '@fairsplit/logging';

export const webLogger = createLogger({ service: 'web' });
