/**
 * Pharol · envio do investimento do Google Ads
 *
 * Roda dentro da conta do Google Ads (Ferramentas > Ações em massa > Scripts), de hora em hora.
 * Envia gasto, impressões, cliques e conversões por campanha e por dia dos últimos DIAS dias.
 * Nada é alterado na conta: o script só lê relatórios.
 *
 * Antes de salvar, preencha LOJA e CHAVE abaixo.
 */
var CONFIG = {
  LOJA: 'aphago',   // 'aphago' ou 'abrasso'
  CHAVE: 'COLE_A_CHAVE_AQUI',
  DIAS: 90,         // quantos dias para trás são reenviados a cada execução
  URL: 'https://gajxzdfcttcocsnjdvha.supabase.co/functions/v1/ingest-google-ads'
};

function main() {
  if (CONFIG.CHAVE === 'COLE_A_CHAVE_AQUI') throw new Error('Preencha a CHAVE no início do script.');

  var tz = AdsApp.currentAccount().getTimeZone();
  var hoje = new Date();
  var inicio = new Date(hoje.getTime() - (CONFIG.DIAS - 1) * 24 * 3600 * 1000);
  var ate = Utilities.formatDate(hoje, tz, 'yyyy-MM-dd');
  var desde = Utilities.formatDate(inicio, tz, 'yyyy-MM-dd');

  var query =
    'SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value ' +
    'FROM campaign ' +
    "WHERE segments.date BETWEEN '" + desde + "' AND '" + ate + "' " +
    'AND metrics.impressions > 0';

  var rows = [];
  var it = AdsApp.search(query);
  while (it.hasNext()) {
    var r = it.next();
    rows.push({
      day: r.segments.date,
      campaign_id: String(r.campaign.id),
      campaign_name: r.campaign.name,
      channel: r.campaign.advertisingChannelType,
      cost: Number(r.metrics.costMicros || 0) / 1e6,
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      conversions: Number(r.metrics.conversions || 0),
      conversion_value: Number(r.metrics.conversionsValue || 0)
    });
  }

  var resposta = UrlFetchApp.fetch(CONFIG.URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-key': CONFIG.CHAVE },
    payload: JSON.stringify({
      store: CONFIG.LOJA,
      customer_id: AdsApp.currentAccount().getCustomerId(),
      desde: desde,
      ate: ate,
      rows: rows
    }),
    muteHttpExceptions: true
  });

  var codigo = resposta.getResponseCode();
  Logger.log('Pharol respondeu ' + codigo + ': ' + resposta.getContentText());
  if (codigo !== 200) throw new Error('Envio para o Pharol falhou (' + codigo + '). Veja o registro acima.');
}
