// Choix de la langue des pages légales: ?lang=en, sinon la langue mémorisée par l'app (sp-lang), sinon celle du navigateur.
(function () {
  var q = new URLSearchParams(location.search).get('lang');
  var saved = null;
  try { saved = localStorage.getItem('sp-lang'); } catch (e) {}
  var lang = q || saved || ((navigator.language || 'fr').toLowerCase().indexOf('en') === 0 ? 'en' : 'fr');
  if (lang !== 'en') lang = 'fr';
  function apply(l) {
    document.documentElement.lang = l;
    var blocks = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < blocks.length; i++) blocks[i].classList.toggle('on', blocks[i].getAttribute('data-lang') === l);
    var btns = document.querySelectorAll('.langs button');
    for (var j = 0; j < btns.length; j++) btns[j].setAttribute('aria-pressed', btns[j].getAttribute('data-set') === l ? 'true' : 'false');
    document.title = document.querySelector('[data-lang="' + l + '"] h1').textContent + ' | MeteoShoot';
  }
  apply(lang);
  var btns = document.querySelectorAll('.langs button');
  for (var k = 0; k < btns.length; k++) btns[k].addEventListener('click', function () { apply(this.getAttribute('data-set')); });
  var back = document.querySelector('a.back');
  if (back && document.referrer && document.referrer.indexOf(location.host) !== -1) back.addEventListener('click', function (e) { e.preventDefault(); history.back(); });
})();
