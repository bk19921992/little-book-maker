-- Print orders can now reach a paid/confirmed state: Peecho orders stay
-- OPEN until confirmed through the provider payment endpoint, and only a
-- confirmed order is ever produced. 'paid' records that confirmation.
-- 'submitted' keeps its meaning: created upstream, payment not confirmed.

alter table public.print_orders drop constraint if exists print_orders_status_check;
alter table public.print_orders add constraint print_orders_status_check
  check (status in ('pending', 'submitted', 'paid', 'failed'));

-- Each order's print file is stored at an immutable per-payment key and the
-- fingerprint pins the provider order to those exact bytes.
alter table public.print_orders add column if not exists pdf_sha256 text;
