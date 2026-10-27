-- Tradução de origens vistas na primeira carga da Abrasso
insert into public.channel_map (source, medium, canal, grupo) values
  ('ref:abrasso.com.br',     '*', 'Direto',        'direto'),
  ('ref:meu.abrasso.com.br', '*', 'Direto',        'direto'),
  ('ref:br.search.yahoo.com','*', 'Yahoo orgânico','sem utm')
on conflict (source, medium) do nothing;
