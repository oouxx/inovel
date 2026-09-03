import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../database';

/**
 * AI 配置持久化 —— 存储在 DATA_DIR/ai-config.json
 *
 * 优先级:ai-config.json > 环境变量 > 内置默认值
 * apiKey 只存服务端文件,接口永远不回传明文(仅返回掩码提示)
 */

export interface AIConfigFile {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  updatedAt?: number;
}

function file(): string {
  return path.join(DATA_DIR(), 'ai-config.json');
}

export function loadAIConfigFile(): AIConfigFile {
  try {
    const raw = readFileSync(file(), 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export function saveAIConfigFile(patch: AIConfigFile): AIConfigFile {
  mkdirSync(DATA_DIR(), { recursive: true });
  const next: AIConfigFile = { ...loadAIConfigFile(), ...patch, updatedAt: Date.now() };
  // patch 中显式携带 apiKey='' 时表示清除已存 key
  if ('apiKey' in patch && (patch.apiKey === '' || patch.apiKey == null)) delete next.apiKey;
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** 打码展示,如 sk-abc…wxyz */
export function maskApiKey(key: string): string {
  const t = key.trim();
  if (!t) return '';
  if (t.length <= 8) return `${t.slice(0, 2)}****`;
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}