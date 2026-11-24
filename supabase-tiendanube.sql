-- Venta automática de los profesores por Tiendanube (tiendanube.js).
-- Ejecutar una vez en el SQL Editor de Supabase (proyecto innova-school-tutores).
-- Solo el servidor del panel lee y escribe estas tablas (clave service_role); RLS cierra el acceso público.

-- Token de la tienda conectada (lo guarda /api/tiendanube/instalar).
create table if not exists public.panel_integrations (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Un registro por pedido pagado: evita crear códigos o enviar el correo dos veces.
create table if not exists public.tiendanube_orders (
  order_id text primary key,
  store_id text,
  order_number text,
  buyer_email text,
  buyer_name text,
  codes jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  status text not null default 'pendiente',
  emailed_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tiendanube_orders_created_idx on public.tiendanube_orders(created_at);

alter table public.panel_integrations enable row level security;
alter table public.tiendanube_orders enable row level security;

-- Pedidos sin correo enviado (para revisar):
-- select order_number, buyer_email, status, email_error, created_at from public.tiendanube_orders
-- where emailed_at is null order by created_at desc;
