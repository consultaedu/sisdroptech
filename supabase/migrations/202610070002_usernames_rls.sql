-- Para projetos que já aplicaram a migração de usuários. Pode ser executado novamente.
alter table private.username_login_attempts enable row level security;
