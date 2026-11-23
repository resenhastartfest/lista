# StartFest

Site mobile-first de gerenciamento de listas da Resenha Start Fest, para divulgar eventos e receber listas de convidados. A interface usa Vite + TypeScript.

## Desenvolvimento

```sh
npm install
npm run dev
```

Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` para carregar eventos publicados do Supabase e habilitar inscrições. A chave anon é pública e protegida pelas políticas RLS; nunca coloque a service-role key no frontend. Sem essas variáveis, a página mostra eventos demonstrativos e mantém o envio desabilitado.

```sh
npm run build
```

## GitHub Pages

O workflow gera e publica o site em pushes para `main`; pull requests executam apenas o build. Em **Settings > Pages > Build and deployment**, selecione **GitHub Actions**. Em **Settings > Secrets and variables > Actions**, cadastre a URL do projeto como variável `VITE_SUPABASE_URL` e a chave pública anon como segredo `VITE_SUPABASE_ANON_KEY`. No repositório `resenhastartfest/lista`, o endereço esperado é `https://resenhastartfest.github.io/lista/`; o build usa `/lista/` como caminho base, enquanto o desenvolvimento local usa `/`. Sem as configurações do Supabase, o site mostra eventos demonstrativos e não aceita inscrições.

## Supabase

1. Para um projeto novo do Supabase, vincule-o com `npx supabase link --project-ref SEU_PROJECT_REF` e aplique todas as migrations com `npx supabase db push --remote`. Para continuar usando o projeto existente, preserve o banco e confira as migrations pendentes antes de aplicá-las; o código no Git não copia automaticamente eventos, listas, usuários ou arquivos do Storage para outro projeto.
2. Configure os segredos da função `submit-guest-list`: `RATE_LIMIT_SECRET` (segredo aleatório) e `ALLOWED_ORIGINS=https://resenhastartfest.github.io,http://localhost:5173` (origens exatas separadas por vírgula, sem caminho nem curingas). Se o site antigo continuar em uso com o mesmo Supabase, inclua também `https://ednilsontheedmaster.github.io` na lista; mantenha outras origens necessárias. O Supabase fornece `SUPABASE_SERVICE_ROLE_KEY` automaticamente à função; ela nunca deve ser publicada no site.
3. Implante a função com `npx supabase functions deploy submit-guest-list`. A configuração de autenticação e os administradores pertencem ao projeto Supabase; um projeto novo exige sua própria configuração e criação de usuários.

A função valida cada pessoa, exige consentimento, limita listas a dez pessoas e aplica limite de envios por janela usando um identificador HMAC do IP. Escritas são atômicas e acessíveis somente à função com a chave de serviço; o navegador nunca recebe essa chave. RLS permite leitura pública apenas de eventos publicados e reserva os dados pessoais da lista aos usuários autenticados cujo `app_metadata.role` seja `admin`.

As tabelas `guest_list_submissions` e `guest_list_entries` separam cada envio de seus convidados e permitem agregações futuras por evento e tipo de entrada. Não são coletados dados de contato dos convidados. Eventos são ocultados e deixam de aceitar inscrições no horário de início, sem serem excluídos do banco.

## Administração

1. Aplique todas as migrations pendentes no projeto vinculado: `npx supabase db push --remote`. A migration administrativa cria o bucket público `event-posters`, restringe uploads a administradores e permite que eles editem ou excluam convidados. Eventos são retirados da agenda por cancelamento, sem apagar seu histórico.
2. No Supabase, em **Authentication > Users**, crie o usuário com e-mail e senha. Pelo SQL Editor, atualize **somente o usuário desejado** com o papel administrativo, substituindo o endereço abaixo e verificando que uma única linha foi alterada:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'admin@example.com';
   ```

   Use `app_metadata`, nunca `user_metadata`: usuários comuns podem alterar seus próprios `user_metadata`. O administrador deve sair e entrar novamente para atualizar o token após mudança de papel. Proteja a conta e não compartilhe a senha.
3. Publique o build e acesse `admin.html` pelo link Administração no rodapé. Entre com a conta configurada. O cliente usa a URL e chave pública do projeto; a autorização é aplicada no banco e no Storage, não por uma chave de serviço no navegador.
4. Em **Novo evento**, informe os dados e selecione uma imagem JPEG, PNG ou WebP de até 5 MB. Escolha **Publicado** para aparecer na agenda, **Rascunho** para manter privado ou **Cancelado** para ocultar. Datas são informadas no horário de Brasília (UTC−03:00); horários futuros devem ser revisados caso o fuso ou horário de verão mude. Ao substituir uma imagem, a anterior permanece no Storage até uma limpeza administrativa deliberada.
5. Em **Ver lista**, consulte, corrija ou exclua convidados individualmente. Exclusões de convidados são permanentes; retirar um evento da agenda preserva as inscrições. Para encaminhar a lista, escolha **Preparar e-mail**, informe o destinatário e anexe manualmente o CSV baixado no aplicativo de e-mail antes de enviar. O site não envia e-mails automaticamente nem confirma a entrega. Confira o destinatário antes de compartilhar dados pessoais.

O bucket de cartazes é público, portanto não envie documentos pessoais ou imagens privadas. CSVs baixados contêm dados pessoais: mantenha-os protegidos e descarte-os quando não forem mais necessários. Limpeza de imagens antigas no Storage não deve remover cartazes ainda usados por eventos.

## Conteúdo e identidade visual

Os três eventos incluídos são demonstrativos e estão espelhados na migration; substitua-os pela programação oficial antes de publicar. `public/startfest-logo.jpeg` usa o logo fornecido; `public/favicon.png` é um recorte otimizado da mesma arte. A paleta foi amostrada diretamente do arquivo: preto `#0A0A0A`, verde `#053F0C`, dourado `#E9B142` e branco `#F4F1EC`.
