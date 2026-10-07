import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config/env.js';
import { RedisChatQuota } from '../../infrastructure/queue/redis-quota.js';
import { APP_CONFIG, CHAT_QUOTA } from '../../ports/index.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { ClaudeDesignAgent } from './claude.agent.js';
import { CLAUDE_AGENT, RULES_AGENT } from './design-agent.js';
import { RuleBasedDesignAgent } from './rule-based.agent.js';

@Module({
  imports: [ProjectsModule, CatalogModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    { provide: CHAT_QUOTA, useClass: RedisChatQuota },
    { provide: RULES_AGENT, useClass: RuleBasedDesignAgent },
    {
      provide: CLAUDE_AGENT,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        new ClaudeDesignAgent({ apiKey: c.ANTHROPIC_API_KEY, model: c.CHAT_MODEL, maxToolTurns: c.CHAT_MAX_TOOL_TURNS }),
    },
  ],
})
export class ChatModule {}
