class StoreClosedError(RuntimeError):
    """write attempted on a store whose owning user has been deleted"""
