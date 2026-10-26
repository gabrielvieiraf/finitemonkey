# Fluxos do usuário

> Modelo para `docs/flows.md`. Crie uma seção para cada fluxo do usuário. Mantenha explícita a ordem dos campos. Registre decisões como tomadas ou pendentes; não apresente suposições como requisitos definidos.

## [Nome do fluxo]

### Objetivo e gatilho

- **Objetivo do usuário:** [o que a pessoa quer realizar]
- **Gatilho:** [evento ou ponto de entrada]
- **Pré-condições:** [estado ou permissões necessárias]
- **Resultado:** [resultado bem-sucedido e observável]

### Etapas e campos

Liste os campos na ordem em que aparecem ou são preenchidos. Inclua validação e visibilidade condicional.

| Etapa | Tela ou ação | Campo (ordem) | Regra / validação | Próxima etapa |
|---|---|---|---|---|
| 1 | [Tela/ação] | [Campo 1] | [Obrigatório, formato, restrições] | [Decisão ou etapa] |
| 2 | [Tela/ação] | [Campo 2] | [Obrigatório, formato, restrições] | [Decisão ou etapa] |

### Regras e decisões

- **Regras:** [regras de negócio, permissões, validação e comportamento de erro]
- **Decisões tomadas:** [decisão e justificativa]
- **Decisões pendentes:** [pergunta, responsável e prazo ou dependência bloqueadora]

### Componentes e estados

| Componente | Finalidade | Estados a cobrir |
|---|---|---|
| [Componente] | [Finalidade] | [Padrão, carregando, vazio, erro, sucesso, desabilitado quando aplicável] |

### Ordem de implementação

1. [Pré-requisito ou contrato de dados]
2. [Componente ou serviço principal]
3. [Fluxo principal e validação]
4. [Estados de erro, vazio e sucesso]
5. [Testes e verificações de acessibilidade]

### Verificação

- [ ] O caminho principal funciona.
- [ ] Falhas de validação e permissão estão cobertas.
- [ ] Estados de carregamento, vazio, erro e sucesso estão definidos quando relevantes.
- [ ] O uso por teclado e tecnologias assistivas foi considerado.
- [ ] Os testes cobrem os critérios de aceitação.

Repita esta seção para cada fluxo de usuário distinto.
