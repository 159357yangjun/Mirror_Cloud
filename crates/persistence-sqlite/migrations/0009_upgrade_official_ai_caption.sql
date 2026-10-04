UPDATE plugins
SET
  version = '1.1.0',
  manifest_json = '{"id":"official.ai-caption","name":"AI Image Caption","version":"1.1.0","description":"使用支持视觉输入的 OpenAI-compatible 接口真正读取图片并生成说明或 Alt Text。","kind":"ai_prompt","permissions":["read_asset","network","secret"],"config_schema":{"prompt":{"type":"string"}}}',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = 'official.ai-caption';
