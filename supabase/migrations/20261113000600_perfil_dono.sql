-- Dia 11D (1/2): novo perfil `dono` (Seu Filipe). Fica num arquivo próprio porque um valor novo de enum
-- só pode ser usado depois que a transação que o criou termina.
alter type perfil add value if not exists 'dono';
