from services.docling_worker.convert import compute_metrics, export_doc_to_dict


class DummyText:
    def __init__(self, text):
        self.text = text


class DummyDoc:
    def __init__(self):
        self.num_pages = 2
        self.texts = [DummyText("abc"), DummyText("defg")]
        self.tables = [object()]


class DummyDump:
    def model_dump(self):
        return {"ok": True}


def test_compute_metrics():
    doc = DummyDoc()
    metrics = compute_metrics(doc, "markdown")
    assert metrics["pages"] == 2
    assert metrics["textChars"] == 7
    assert metrics["mdChars"] == 8
    assert metrics["textItems"] == 2
    assert metrics["tables"] == 1
    assert metrics["textCharsPerPageAvg"] == 3.5


def test_export_doc_to_dict_fallback():
    doc = DummyDump()
    data = export_doc_to_dict(doc)
    assert data == {"ok": True}


class DummyCallableDoc:
    def num_pages(self):
        return 3

    def texts(self):
        return [DummyText("hello"), DummyText("world")]

    def tables(self):
        return []


def test_compute_metrics_supports_callable_fields():
    doc = DummyCallableDoc()
    metrics = compute_metrics(doc, "markdown")
    assert metrics["pages"] == 3
    assert metrics["textChars"] == 10
    assert metrics["textItems"] == 2
