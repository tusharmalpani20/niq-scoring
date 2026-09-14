-- Existing hosting arrangements are unknown; do not infer a provider.
ALTER TABLE deployments ADD COLUMN hosting_type varchar(30);
ALTER TABLE deployments ADD CONSTRAINT deployments_hosting_type_ck CHECK (hosting_type IS NULL OR hosting_type IN ('NIQ_HOSTED','CLIENT_CLOUD','ON_PREMISES'));
