-- Seed test user and API key
INSERT INTO users (id, wallet, name) VALUES
  ('00000000-0000-0000-0000-000000000001', '0x33feaef1f4cd36afe83f2bb2ea10ae62097f4f74', 'Test User')
ON CONFLICT (wallet) DO NOTHING;

-- API key hash for: x402_691bd743b64656df9adf9cf77ca6b1a042b60afe82b69fdbf0d0107ddf9c82e4
INSERT INTO api_keys (user_id, name, api_key_hash, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Test API Key', '5d19d00b5171bc895d543bb35d7d518ef0a7f666f0c03e68d955797d7f1efebc', 'active')
ON CONFLICT (api_key_hash) DO NOTHING;
