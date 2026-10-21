import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config/env.js';
import { PhotoProcessor } from '../../infrastructure/imaging/photo-processor.js';
import { RedisChatQuota } from '../../infrastructure/queue/redis-quota.js';
import { AI_CLIENT, APP_CONFIG, CHAT_QUOTA, FILE_STORAGE, type IAiClient, type IFileStorage } from '../../ports/index.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ChatController } from './chat.controller.js';
import { CHAT_AGENTS, ChatService, REFERENCE_DEPS, type ChatAgents, type ReferenceDeps } from './chat.service.js';
import { ClaudeDesignAgent } from './claude.agent.js';
import { GroqDesignAgent } from './groq.agent.js';
import { LocalNluDesignAgent } from './local-nlu.agent.js';
import { RuleBasedDesignAgent } from './rule-based.agent.js';

@Module({
  imports: [ProjectsModule, CatalogModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    { provide: CHAT_QUOTA, useClass: RedisChatQuota },
    {
      provide: CHAT_AGENTS,
      inject: [APP_CONFIG, AI_CLIENT],
      useFactory: (c: AppConfig, ai: IAiClient): ChatAgents => ({
        local: new LocalNluDesignAgent(ai, { minConfidence: c.NLU_MIN_CONFIDENCE }),
        groq: new GroqDesignAgent({ apiKey: c.GROQ_API_KEY, model: c.GROQ_CHAT_MODEL, maxToolTurns: Math.min(c.CHAT_MAX_TOOL_TURNS, 6) }),
        claude: new ClaudeDesignAgent({ apiKey: c.ANTHROPIC_API_KEY, model: c.CHAT_MODEL, maxToolTurns: c.CHAT_MAX_TOOL_TURNS }),
        rules: new RuleBasedDesignAgent(),
      }),
    },
    {
      provide: REFERENCE_DEPS,
      inject: [APP_CONFIG, AI_CLIENT, FILE_STORAGE, PhotoProcessor],
      useFactory: (c: AppConfig, ai: IAiClient, storage: IFileStorage, photos: PhotoProcessor): ReferenceDeps => ({
        ai,
        storage,
        photos,
        maxBytes: c.UPLOAD_MAX_MB * 1024 * 1024,
      }),
    },
  ],
})
export class ChatModule {}
