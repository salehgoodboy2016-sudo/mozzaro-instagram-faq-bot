UPDATE meta_campaign_test_sends
SET status='failed',error_category='meta_permissions_rejected',updated_at=now()
WHERE request_id='focaccia-direct-test-20261007-001'
  AND status='ambiguous' AND error_code='200';
