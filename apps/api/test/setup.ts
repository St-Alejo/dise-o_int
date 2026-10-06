import { Logger } from '@nestjs/common';

// Los tests verifican comportamiento, no logs.
Logger.overrideLogger(false);
