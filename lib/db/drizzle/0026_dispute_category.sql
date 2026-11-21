-- Preserve the provider's actual classification. NULL/unknown is not inferred
-- to be a non-fraud claim, and no historical classification is fabricated.
ALTER TABLE valo_payment_disputes ADD COLUMN category text;
