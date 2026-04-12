// Entry point — wired in M3-4 (ACO-21) once youtube-client and poller are complete.
// For now, validates env at startup and exits.
import { parseEnv } from '@/env';

const _Env = parseEnv(process.env);
