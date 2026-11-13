# Cidade dos Dados

Comparação visual, em 3D pixelado, de três tipos de extração de dados:

| Pista | Na cidade | Na vida real |
|---|---|---|
| **API** | Van que vai ao guichê pedir uma página de dados | Requisições HTTP (REST/JSON), paginação, rate limit |
| **Web Scraping** | Robô que lê a vitrine do site e copia os carros | Baixar HTML e recortar com seletores CSS/XPath |
| **Arquivo em lote** | Cegonha que leva todos os carros no horário marcado | CSV/Excel exportado por um sistema (SFTP, pasta, bucket) |

Depois de extraído, todo carro (registro) passa pelo caminho até o banco:

| Lugar na cidade | Etapa do pipeline |
|---|---|
| Área de pouso | Salva a cópia bruta (raw) para poder reprocessar |
| Pedágio | Validação de schema (campos obrigatórios, colunas) |
| Lava-rápido | Transformação (tipos, datas, limpeza) |
| Detector de duplicados | Remove registros repetidos pela chave |
| Posto | Enriquecimento (cruza com outras tabelas) |
| Portão de carga | INSERT/UPSERT no banco, em transação |
| Torre / relógio | Monitoramento (logs, alertas) / orquestrador (Airflow) |

Carro sujo = dado bruto, colorido = tratado, caixa amarela no teto = enriquecido, vermelho = rejeitado (vai para a quarentena). No modo **ELT** as etapas de transformação ficam desligadas na estrada e acontecem dentro do banco.

### Como usar

- **Tipo de coleta** (canto superior esquerdo): escolhe qual coleta aparece na tela (uma por vez).
- **Clique em qualquer objeto** (carro, lava-rápido, van, robô, cegonha, prédios…) para ver o que ele significa. O carro mostra em que etapa está e há quanto tempo saiu da fonte.
- **Comparar**: tabela com as três coletas lado a lado (elas rodam o tempo todo, mesmo fora da tela).
- **Câmera**: arrastar move pelo mapa, botão direito gira, scroll dá zoom onde está o mouse, duplo clique centraliza, setas do teclado também movem. **Seguir um carro** faz a câmera acompanhar um registro do começo ao fim.
- O botão do meio muda conforme a coleta: *rate limit (429)* na API, *mudar layout* no scraping, *gerar lote* no arquivo.

## Como rodar no VS Code

Pré-requisito: [Node.js](https://nodejs.org) 18 ou mais novo (`node -v` no terminal para conferir).

1. No VS Code: **File → Open Folder…** e escolha `Documents/cidade-dos-dados`
2. Abra o terminal integrado (**Terminal → New Terminal** ou `` Ctrl+` ``)
3. Instale as dependências (só na primeira vez):
   ```bash
   npm install
   ```
4. Rode o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```
   O navegador abre sozinho em `http://localhost:5173`. Ao salvar um arquivo, a página recarrega na hora.

Para parar o servidor: `Ctrl+C` no terminal.

### Sem instalar nada

O arquivo `versao-standalone.html` é a versão completa num arquivo só: é só dar dois cliques para abrir no navegador.

## Estrutura

```
cidade-dos-dados/
├── index.html              # layout da página + snippets de código em Python
├── src/
│   ├── main.js             # cena 3D (Three.js), simulação e interface
│   └── style.css           # visual dos painéis
├── versao-standalone.html  # tudo embutido, abre sem npm
└── package.json
```

## Onde mexer em `src/main.js`

- `LANES`: nome, cor e taxa de dados inválidos de cada coleta
- `state`: intervalo de polling da API (`pollEvery`), intervalo do lote (`batchEvery`), ritmo de novos registros (`genEvery`)
- `updateAPI`, `updateScrap`, `updateBatch`: a lógica de cada tipo de extração
- `STATIONS`: as etapas do caminho até o banco (posição, tempo de parada, o que reprovam)
- `buildStation` / `stationDone`: o visual de cada etapa e o que acontece com o carro nela
- `updateRoad`: estrada, fila e paradas (ETL/ELT)
- `OBJ_INFO`: o texto que aparece ao clicar em cada objeto
- `INFO`: textos da explicação completa (janela com código)
- `selectLane`: troca a coleta visível e move a câmera

Os snippets de código que aparecem no painel ficam no final do `index.html` (`<script type="text/plain" id="code-...">`).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor local com recarregamento automático |
| `npm run build` | Gera a versão final em `dist/` |
| `npm run preview` | Abre a versão de `dist/` para conferir |
