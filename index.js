const fastify = require('fastify')({ logger: true });
const swisseph = require('swisseph');
const { DateTime } = require('luxon');
const { z } = require('zod');

// تفعيل CORS للسماح بالاتصال من CodePen
fastify.register(require('@fastify/cors'), { origin: '*' });

// تحديد مسار البيانات (المعادلات المدمجة ستعمل تلقائياً)
swisseph.swe_set_ephe_path('./ephe');

// معيار التحقق من البيانات (Validation)
const AstroSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  timezone: z.string().default('UTC'),
  houseSystem: z.enum(['P', 'W', 'K', 'O']).default('P')
});

fastify.post('/calculate', async (request, reply) => {
  try {
    const data = AstroSchema.parse(request.body);

    // حساب التوقيت العالمي UTC بدقة Luxon
    const localDT = DateTime.fromISO(`${data.date}T${data.time}`, { zone: data.timezone });
    const utc = localDT.toUTC();

    // استخراج اليوم الجولياني (نظام UT) عبر العنصر الثاني في المصفوفة [1]
    const jdResult = swisseph.swe_utc_to_jd(
      utc.year, utc.month, utc.day,
      utc.hour, utc.minute, utc.second,
      1
    );
    const jdUT = jdResult[1]; 

    const flags = swisseph.SEFLG_SWIEPH | swisseph.SEFLG_SPEED;
    const bodies = {
      sun: swisseph.SE_SUN,
      moon: swisseph.SE_MOON,
      mercury: swisseph.SE_MERCURY,
      venus: swisseph.SE_VENUS,
      mars: swisseph.SE_MARS,
      jupiter: swisseph.SE_JUPITER,
      saturn: swisseph.SE_SATURN
    };

    const planets = {};
    for (const [name, id] of Object.entries(bodies)) {
      const res = swisseph.swe_calc_ut(jdUT, id, flags);
      planets[name] = {
        lon: res.longitude,
        lat: res.latitude,
        speed: res.longitudeSpeed
      };
    }

    // حساب البيوت باستخدام القيمة الرقمية لنظام البيوت
    const houses = swisseph.swe_houses(
      jdUT,
      data.lat,
      data.lon,
      data.houseSystem.charCodeAt(0)
    );

    return {
      success: true,
      meta: { jd: jdUT, utc: utc.toISO() },
      planets,
      houses: houses.house,
      ascendant: houses.ascendant,
      mc: houses.mc
    };

  } catch (err) {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: "بيانات الإدخال غير صحيحة", details: err.errors });
    }
    return reply.code(500).send({ error: "خطأ داخلي في المحرك", msg: err.message });
  }
});

// تشغيل الخادم على المنفذ المخصص للبيئة السحابية
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port: port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();