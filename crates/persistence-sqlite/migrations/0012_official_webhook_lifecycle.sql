UPDATE plugins
SET version = '1.2.0',
    manifest_json = '{"id":"official.webhook","name":"Webhook Publisher","version":"1.2.0","description":"在处理前后、上传成功、发布失败或云端删除后向你自己的 Webhook 发送资源事件。","kind":"webhook","permissions":["read_asset","network","external_write"],"hooks":["before_process","after_process","after_upload","on_publish_failure","on_gallery_delete","manual_trigger"],"config_schema":{"endpoint":{"type":"url"}}}',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'official.webhook';
