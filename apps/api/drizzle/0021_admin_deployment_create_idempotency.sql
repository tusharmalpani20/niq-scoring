-- The deployment and its audit event commit together. A create retry with the
-- same key must resolve to that event rather than create another deployment.
CREATE UNIQUE INDEX "admin_deployment_create_key_uq" ON "audit_events" ((metadata->>'createKey'))
  WHERE action='DEPLOYMENT_CREATED' AND metadata ? 'createKey';
