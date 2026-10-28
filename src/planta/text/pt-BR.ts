import type { BlueprintText } from "./types.js";

export const ptBR: BlueprintText = {
  problem: {
    title: "Problema e público escritos",
    why: "Sem um problema e uma pessoa com nome, toda funcionalidade parece igualmente urgente.",
    minimum: "Um parágrafo: quem tem o problema, quanto custa hoje, como resolve agora.",
  },
  rules: {
    title: "Regras de negócio escritas",
    why: "Regra que só existe na cabeça de alguém é programada diferente em cada tela.",
    minimum: "Um documento em docs/ com as regras que o código precisa seguir, uma por linha.",
  },
  pricing: {
    title: "Planos e preço",
    why: "Cobrança, limites e a página de venda dependem do que cada plano inclui.",
    minimum: "Uma tabela de planos com preço, período e o que cada um libera.",
  },
  api: {
    title: "API separada da tela",
    why: "Regra dentro da tela não dá para testar, reaproveitar nem proteger no servidor.",
    minimum: "Rotas de servidor numa pasta própria, chamadas pelas telas.",
  },
  database: {
    title: "Banco com migrações",
    why: "Mudar tabela na mão em produção perde dado e não dá para repetir.",
    minimum: "Uma pasta de migrações ou arquivo de schema que cria todas as tabelas do zero.",
  },
  auth: {
    title: "Contas e login",
    why: "Sem contas, qualquer um vê os dados de qualquer um.",
    minimum: "Cadastro, login e logout por uma biblioteca mantida.",
  },
  "password-reset": {
    title: "Recuperação de senha",
    why: "As pessoas esquecem a senha na primeira semana; sem recuperação, vão embora.",
    minimum: "Um link de troca por e-mail que expira e vale uma vez.",
  },
  tenants: {
    title: "Separação entre empresas clientes (B2B)",
    why: "Em B2B, uma empresa ver os registros de outra encerra o contrato.",
    minimum: "Toda consulta filtrada pelo id da empresa ou do espaço de trabalho.",
  },
  states: {
    title: "Estados de carregando, vazio e erro",
    why: "Tela que não mostra nada enquanto carrega ou falha parece quebrada.",
    minimum: "Cada tela de dados tem carregando, vazio e erro além do estado normal.",
  },
  billing: {
    title: "Cobrança",
    why: "Sem cobrar, é uma ferramenta gratuita, não um SaaS.",
    minimum: "Checkout por um provedor de pagamento ligado à conta.",
  },
  webhooks: {
    title: "Webhooks de pagamento idempotentes",
    why: "Provedores reenviam eventos; sem idempotência, um pagamento é aplicado duas vezes.",
    minimum: "Cada id de evento fica gravado e o repetido é ignorado.",
  },
  "renewal-refund": {
    title: "Renovação e reembolso",
    why: "Assinaturas renovam e pessoas pedem o dinheiro de volta; os dois mudam o acesso.",
    minimum: "Renovação estende o acesso, reembolso tira, os dois registrados.",
  },
  cents: {
    title: "Dinheiro em centavos",
    why: "Ponto flutuante transforma 0,1 + 0,2 em 0,30000000000000004 numa fatura.",
    minimum: "Valores gravados e calculados como centavos inteiros.",
  },
  types: {
    title: "Checagem de tipos",
    why: "Tipos pegam campo errado e valor faltando antes do usuário.",
    minimum: "Um verificador de tipos configurado e rodando no projeto inteiro.",
  },
  lint: {
    title: "Linter",
    why: "O linter acha código sem uso e bugs comuns a cada mudança.",
    minimum: "Um linter configurado para a linguagem do projeto.",
  },
  tests: {
    title: "Testes das regras de negócio",
    why: "Sem testes, qualquer mudança pode quebrar cobrança ou acesso sem ninguém ver.",
    minimum: "Testes das regras que mexem com dinheiro ou permissão, passando nesta árvore.",
  },
  ci: {
    title: "Integração contínua",
    why: "Checagem que só roda num notebook para de rodar.",
    minimum: "Um workflow de CI que roda tipos, lint e testes a cada push.",
  },
  secrets: {
    title: "Segredos fora do código",
    why: "Chave commitada uma vez fica no histórico para quem tiver o repositório.",
    minimum: "Chaves só em variáveis de ambiente; a checagem de segredos passa nesta árvore.",
  },
  "rate-limit": {
    title: "Limite de requisições",
    why: "Sem limite, um script derruba o serviço ou testa senhas sem parar.",
    minimum: "Um limite no login e nas rotas públicas.",
  },
  privacy: {
    title: "Dados pessoais: base legal e exclusão",
    why: "A LGPD exige um jeito de apagar ou exportar os dados de uma pessoa.",
    minimum: "Um caminho de exclusão de conta ou de exportação de dados.",
  },
  backup: {
    title: "Backup testado",
    why: "Backup nunca restaurado é um palpite.",
    minimum: "Backup automático do banco e uma restauração feita e anotada.",
  },
  environments: {
    title: "Ambientes de teste e produção",
    why: "Testar em produção quebra para usuários de verdade.",
    minimum: "Configurações separadas por ambiente, documentadas no .env.example.",
  },
  rollback: {
    title: "Deploy com volta atrás",
    why: "Deploy ruim sem volta deixa o site fora do ar enquanto alguém conserta ao vivo.",
    minimum: "Deploy por pipeline, e a versão anterior volta em minutos.",
  },
  logs: {
    title: "Logs e alerta",
    why: "Sem log, o primeiro aviso de erro vem de um cliente bravo.",
    minimum: "Erros gravados com contexto e um alerta quando disparam.",
  },
  terms: {
    title: "Termos de uso e política de privacidade",
    why: "Cobrar e guardar dado pessoal sem eles é risco jurídico.",
    minimum: "Páginas de termos e privacidade com link no cadastro.",
  },
  message: {
    title: "Uma promessa clara",
    why: "Quem visita decide em segundos se a página é para ela.",
    minimum: "Um título que diz para quem é e o que a pessoa ganha.",
  },
  "call-to-action": {
    title: "Chamada para ação",
    why: "Página sem próximo passo só é lida.",
    minimum: "Um botão ou link principal que leva ao próximo passo.",
  },
  contact: {
    title: "Jeito de falar com você",
    why: "Visitante interessado sem como responder se perde.",
    minimum: "Um formulário, e-mail ou link de conversa que chega a uma pessoa.",
  },
  responsive: {
    title: "Funciona no celular",
    why: "A maior parte das visitas a uma página de venda vem do celular.",
    minimum: "Layout que se ajusta a telas estreitas, com a tag de viewport.",
  },
  metadata: {
    title: "Título e prévia de compartilhamento",
    why: "Título e prévia são o que aparece na busca e quando o link é compartilhado.",
    minimum: "Título da página, descrição e imagem de compartilhamento.",
  },
  analytics: {
    title: "Medição de visitas",
    why: "Sem números, ninguém sabe se a página converte.",
    minimum: "Um script de analytics contando visitas e cliques no botão principal.",
  },
  "visual-check": {
    title: "Conferência visual",
    why: "Estouro e layout quebrado só aparecem renderizando de verdade.",
    minimum: "A checagem look passa nesta árvore.",
  },
  "landing-terms": {
    title: "Aviso de privacidade",
    why: "Formulário que pede e-mail ou telefone coleta dado pessoal.",
    minimum: "Uma página de privacidade com link ao lado do formulário.",
  },
  domain: {
    title: "Domínio próprio com HTTPS",
    why: "Endereço provisório e aviso do navegador custam confiança.",
    minimum: "A página servida no próprio domínio por HTTPS.",
  },
};
