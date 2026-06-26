/**
 * `@jects/angular/chatbot` — typed Angular standalone binding for the {@link Chatbot} engine.
 *
 * Importing this subpath pulls in `@jects/chatbot` and the shared factory only, never a
 * sibling engine. Use the root `@jects/angular` entry for the whole suite.
 */
import { createComponent } from './factory.js';
import { Chatbot, type ChatbotConfig, type ChatbotEvents } from '@jects/chatbot';

export const JectsChatbot = createComponent<Chatbot, ChatbotConfig, ChatbotEvents>(Chatbot, {
  selector: 'jects-chatbot',
});

export type { ChatbotConfig, ChatbotEvents };
