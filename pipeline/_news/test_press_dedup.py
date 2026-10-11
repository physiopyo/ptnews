import unittest

import fetch_press as fp


def item(url, title, img=''):
    return {'date': '2026-10-10', 'dt': '2026-10-10T20:12:18+09:00', 'disp': '26.10.10',
            'chip': '매일경제', 'title': title, 'url': url, 'img': img, 'desc': ''}


FULL = '“치료 더 받고 싶은데” vs “보험료 인상 부담”…도수치료 두고 의견차'
CUT = '“치료 더 받고 싶은데” vs “보험료 인상 부담”…도수치료 두고 의견...'


class UrlKeyTests(unittest.TestCase):
    def test_url_forms_of_one_article_share_a_key(self):
        same = [
            ('https://www.mk.co.kr/news/economy/12172753', 'https://www.mk.co.kr/article/12172753'),
            ('https://www.mediapen.com/news/view/1124809', 'https://www.mediapen.com/newsamp/view/1124809'),
            ('https://www.newsis.com/view/NISX20260909_0003782158', 'https://nwww.newsis.com/view/NISX20260909_0003782158'),
            ('https://www.medicaltimes.com/Main/News/NewsView.html?ID=1169796',
             'https://www.medicaltimes.com/Mobile/News/NewsView.html?ID=1169796'),
            ('https://kormedi.com/2859285/', 'https://kormedi.com/?p=2859285'),
            ('https://news.nate.com/view/20260712n02544', 'https://m.news.nate.com/view/20260712n02544?sect=sisa'),
        ]
        for a, b in same:
            self.assertEqual(fp.urlkey(a), fp.urlkey(b), (a, b))

    def test_different_articles_keep_different_keys(self):
        self.assertNotEqual(fp.urlkey('https://www.mk.co.kr/article/12172753'),
                            fp.urlkey('https://www.mk.co.kr/article/12172754'))
        self.assertNotEqual(fp.urlkey('https://www.mk.co.kr/article/12172753'),
                            fp.urlkey('https://www.hankyung.com/article/12172753'))
        # Naver numbers articles per press office: only the full path identifies one.
        self.assertNotEqual(fp.urlkey('https://n.news.naver.com/mnews/article/009/0005512345'),
                            fp.urlkey('https://n.news.naver.com/mnews/article/015/0005512345'))


class SameTitleTests(unittest.TestCase):
    def test_cut_title_matches_its_full_title(self):
        self.assertTrue(fp.same_title(CUT, FULL))
        self.assertTrue(fp.same_title(FULL, CUT))

    def test_uncut_prefix_is_a_different_headline(self):
        self.assertFalse(fp.same_title('도수치료 관리급여 시행 첫날 현장', '도수치료 관리급여 시행 첫날 현장 혼란 이어져'))

    def test_short_cut_title_does_not_match(self):
        self.assertFalse(fp.same_title('도수치료...', '도수치료 관리급여 시행 첫날'))


class DedupeTests(unittest.TestCase):
    def test_reported_mk_pair_becomes_one_full_title_entry(self):
        out = fp.dedupe_articles([
            item('https://www.mk.co.kr/news/economy/12172753', FULL, 'img/a.jpg'),
            item('https://www.mk.co.kr/article/12172753', CUT, 'img/b.jpg'),
        ])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]['url'], 'https://www.mk.co.kr/news/economy/12172753')
        self.assertEqual(out[0]['title'], FULL)

    def test_regular_url_wins_and_full_title_is_taken_from_other_copy(self):
        out = fp.dedupe_articles([
            item('https://www.news1.kr/society/court-prosecution/6277150', '"도수치료 제한=치료권 침해" 헌법소원, 정식심판 회...'),
            item('https://www.news1.kr/amp/society/court-prosecution/6277150', '"도수치료 제한=치료권 침해" 헌법소원, 정식심판 회부'),
        ])
        self.assertEqual([(x['url'], x['title']) for x in out],
                         [('https://www.news1.kr/society/court-prosecution/6277150',
                           '"도수치료 제한=치료권 침해" 헌법소원, 정식심판 회부')])

    def test_outlet_page_beats_portal_copy_with_same_title(self):
        out = fp.dedupe_articles([
            item('https://news.nate.com/view/20260705n03844', '자동차보험 자기부담금 분쟁…대법 "상대 보험사에 청구 가능"'),
            item('https://www.mt.co.kr/society/2026/07/05/2026070310543918555', '자동차보험 자기부담금 분쟁…대법 "상대 보험사에 청구 가능"'),
        ])
        self.assertEqual([x['url'] for x in out], ['https://www.mt.co.kr/society/2026/07/05/2026070310543918555'])

    def test_distinct_articles_and_order_are_kept(self):
        rows = [item('https://a.kr/news/100001', '도수치료 관리급여 첫째 기사 제목입니다'),
                item('https://b.kr/news/100001', '도수치료 관리급여 둘째 기사 제목입니다'),
                item('https://a.kr/news/100002', '도수치료 관리급여 셋째 기사 제목입니다')]
        self.assertEqual(fp.dedupe_articles(rows), rows)

    def test_missing_image_is_filled_from_duplicate(self):
        out = fp.dedupe_articles([item('https://www.mk.co.kr/news/economy/12172753', FULL),
                                  item('https://www.mk.co.kr/article/12172753', CUT, 'img/b.jpg')])
        self.assertEqual(out[0]['img'], 'img/b.jpg')


if __name__ == '__main__':
    unittest.main()
