import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, ValidationError

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "mdl.schema.json"
SCHEMA_ID = "https://raw.githubusercontent.com/Canner/WrenAI/main/wren-mdl/mdl.schema.json"


@pytest.fixture(scope="module")
def validator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def valid_manifest() -> dict:
    return {
        "$schema": SCHEMA_ID,
        "catalog": "main",
        "schema": "analytics",
        "dataSource": "databricks",
        "models": [
            {
                "name": "orders",
                "tableReference": {
                    "catalog": None,
                    "schema": None,
                    "table": "orders",
                },
                "columns": [
                    {
                        "name": "id",
                        "type": "INTEGER",
                        "isCalculated": False,
                    },
                    {
                        "name": "gross_amount",
                        "type": "DOUBLE",
                        "isCalculated": True,
                        "expression": "price * quantity",
                    },
                ],
            }
        ],
        "relationships": [
            {
                "name": "OrdersCustomer",
                "models": ["orders", "customers"],
                "joinType": "MANY_TO_ONE",
                "condition": "orders.customer_id = customers.id",
                "properties": {
                    "description": "orders belongs to customer",
                },
            }
        ],
        "metrics": [
            {
                "name": "order_metrics",
                "baseObject": "orders",
                "dimension": [
                    {
                        "name": "order_date",
                        "type": "DATE",
                    }
                ],
                "measure": [
                    {
                        "name": "total_amount",
                        "type": "DOUBLE",
                        "expression": "sum(gross_amount)",
                    }
                ],
            }
        ],
        "views": [
            {
                "name": "recent_orders",
                "statement": "select * from orders",
                "properties": {
                    "question": "recent orders",
                },
            }
        ],
        "enumDefinitions": [
            {
                "name": "OrderStatus",
                "values": [
                    {
                        "name": "paid",
                        "value": "PAID",
                    }
                ],
            }
        ],
    }


def assert_invalid(validator: Draft202012Validator, manifest: dict) -> ValidationError:
    with pytest.raises(ValidationError) as error:
        validator.validate(manifest)
    return error.value


def test_accepts_current_ui_databricks_manifest_shape(validator):
    validator.validate(valid_manifest())


def test_accepts_datafusion_datasource_for_engine_manifests(validator):
    manifest = valid_manifest()
    manifest["dataSource"] = "DATAFUSION"
    validator.validate(manifest)


def test_rejects_calculated_columns_without_expression(validator):
    manifest = valid_manifest()
    del manifest["models"][0]["columns"][1]["expression"]

    error = assert_invalid(validator, manifest)

    assert list(error.absolute_path) == ["models", 0, "columns", 1]


def test_rejects_metric_measures_without_expression(validator):
    manifest = valid_manifest()
    del manifest["metrics"][0]["measure"][0]["expression"]

    error = assert_invalid(validator, manifest)

    assert list(error.absolute_path) == ["metrics", 0, "measure", 0]


def test_rejects_unknown_relationship_properties(validator):
    manifest = valid_manifest()
    manifest["relationships"][0]["unexpected"] = "value"

    error = assert_invalid(validator, manifest)

    assert list(error.absolute_path) == ["relationships", 0]


def test_rejects_unknown_datasource(validator):
    manifest = valid_manifest()
    manifest["dataSource"] = "REST_JSON"

    error = assert_invalid(validator, manifest)

    assert list(error.absolute_path) == ["dataSource"]
